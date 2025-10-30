"""
Configuración de base de datos PostgreSQL y modelos SQLAlchemy
"""
import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, JSON, Boolean, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import json

# Base para modelos SQLAlchemy
Base = declarative_base()

# Configuración de base de datos
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://lab:password@192.168.1.106:5432/rancoqc')
SQLITE_URL = 'sqlite:///local_cache.db'

# Crear engines
try:
    # Engine principal para PostgreSQL
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
        echo=False  # Cambiar a True para debug SQL
    )
    print("✅ Conexión a PostgreSQL configurada")
    DB_AVAILABLE = True
except Exception as e:
    print(f"⚠️ Error conectando a PostgreSQL: {e}")
    print("📁 Usando SQLite como fallback")
    engine = create_engine(
        SQLITE_URL,
        poolclass=StaticPool,
        connect_args={'check_same_thread': False},
        echo=False
    )
    DB_AVAILABLE = False

# Engine local para caché/backup
local_engine = create_engine(
    SQLITE_URL,
    poolclass=StaticPool,
    connect_args={'check_same_thread': False},
    echo=False
)

# Crear sessions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
LocalSession = sessionmaker(autocommit=False, autoflush=False, bind=local_engine)

# Modelos de base de datos
class AnalysisResult(Base):
    """Modelo para almacenar resultados de análisis"""
    __tablename__ = "analysis_results"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Información básica
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    user_name = Column(String(100), nullable=False)
    analysis_type = Column(String(50), nullable=False)  # qc_recepcion, packing_qc, contramuestra
    profile = Column(String(50), nullable=False)
    
    # Datos del formulario
    distribucion = Column(String(20), nullable=False)  # roja, bicolor
    guia_sii = Column(String(100), nullable=False)
    lote = Column(String(100), nullable=False)
    num_frutos = Column(Integer, nullable=False)
    
    # Campos específicos de Packing QC
    num_proceso = Column(String(100), nullable=True)
    id_caja = Column(String(100), nullable=True)
    
    # Resultados del análisis
    total_detections = Column(Integer, default=0)
    zones_analyzed = Column(Integer, default=0)
    confidence_used = Column(Float, default=0.8)
    results_json = Column(Text, nullable=False)  # JSON con resultados por zona
    detections_by_zone_json = Column(Text, nullable=True)  # JSON con detalles de detecciones
    
    # Imágenes
    original_image_path = Column(String(500), nullable=True)
    processed_image_path = Column(String(500), nullable=True)
    
    # Metadatos técnicos
    image_size = Column(String(50), nullable=True)
    zones_available = Column(Text, nullable=True)  # JSON con zonas disponibles
    
    # Estado de sincronización
    synced_to_server = Column(Boolean, default=False)
    sync_attempts = Column(Integer, default=0)
    last_sync_attempt = Column(DateTime, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class LocalCache(Base):
    """Modelo para caché local cuando no hay conexión"""
    __tablename__ = "local_cache"
    
    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, nullable=True)  # ID del análisis principal (si existe)
    data_json = Column(Text, nullable=False)  # Datos completos en JSON
    data_type = Column(String(50), nullable=False)  # analysis, form_data, etc.
    status = Column(String(20), default='pending')  # pending, synced, failed
    created_at = Column(DateTime, default=datetime.utcnow)
    sync_attempts = Column(Integer, default=0)
    last_sync_attempt = Column(DateTime, nullable=True)

class SyncHistory(Base):
    """Historial de sincronizaciones"""
    __tablename__ = "sync_history"
    
    id = Column(Integer, primary_key=True, index=True)
    sync_timestamp = Column(DateTime, default=datetime.utcnow)
    records_synced = Column(Integer, default=0)
    sync_type = Column(String(50), nullable=False)  # manual, automatic, startup
    status = Column(String(20), nullable=False)  # success, partial, failed
    error_message = Column(Text, nullable=True)
    user_name = Column(String(100), nullable=True)

class User(Base):
    """Modelo de usuario"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(20), nullable=False, default='operador')  # 'admin' o 'operador'
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# Funciones de utilidad para base de datos
def get_db_session():
    """Obtener sesión de base de datos principal"""
    db = SessionLocal()
    try:
        return db
    except Exception:
        db.close()
        raise

def get_local_session():
    """Obtener sesión de base de datos local"""
    db = LocalSession()
    try:
        return db
    except Exception:
        db.close()
        raise

def create_tables():
    """Crear tablas en las bases de datos"""
    try:
        # Crear tablas en PostgreSQL (o SQLite principal)
        Base.metadata.create_all(bind=engine)
        print("✅ Tablas creadas en base de datos principal")
    except Exception as e:
        print(f"⚠️ Error creando tablas principales: {e}")
    
    try:
        # Crear tablas en SQLite local
        Base.metadata.create_all(bind=local_engine)
        print("✅ Tablas creadas en base de datos local")
    except Exception as e:
        print(f"⚠️ Error creando tablas locales: {e}")

def test_db_connection():
    """Probar conexión a base de datos"""
    try:
        db = get_db_session()
        # Intentar una query simple
        db.execute("SELECT 1")
        db.close()
        return True, "Conexión exitosa"
    except Exception as e:
        return False, str(e)

def save_analysis_result(analysis_data, form_data, results_data):
    """Guardar resultado de análisis en la base de datos"""
    try:
        # Intentar guardar en base principal primero
        db = get_db_session()
        
        # Crear registro de análisis con validación de campos numéricos
        try:
            num_frutos_val = form_data.get('num_frutos', 0)
            if num_frutos_val is None or num_frutos_val == '':
                num_frutos_val = 0
            num_frutos_val = int(num_frutos_val)
        except (ValueError, TypeError):
            num_frutos_val = 0
            
        try:
            total_detections_val = results_data.get('total_cherries', 0)
            if total_detections_val is None:
                total_detections_val = 0
            total_detections_val = int(total_detections_val)
        except (ValueError, TypeError):
            total_detections_val = 0
            
        try:
            zones_analyzed_val = results_data.get('zones_loaded', 0)
            if zones_analyzed_val is None:
                zones_analyzed_val = 0
            zones_analyzed_val = int(zones_analyzed_val)
        except (ValueError, TypeError):
            zones_analyzed_val = 0
            
        try:
            confidence_val = results_data.get('confidence_used', 0.8)
            if confidence_val is None:
                confidence_val = 0.8
            confidence_val = float(confidence_val)
        except (ValueError, TypeError):
            confidence_val = 0.8

        # Crear registro de análisis
        analysis_record = AnalysisResult(
            user_name=form_data.get('user', 'Unknown'),
            analysis_type=form_data.get('analysis_type', 'qc_recepcion'),
            profile=form_data.get('profile', 'qc_recepcion'),
            distribucion=form_data.get('distribucion', 'roja'),
            guia_sii=form_data.get('guia_sii', ''),
            lote=form_data.get('lote', ''),
            num_frutos=num_frutos_val,
            num_proceso=form_data.get('num_proceso'),
            id_caja=form_data.get('id_caja'),
            total_detections=total_detections_val,
            zones_analyzed=zones_analyzed_val,
            confidence_used=confidence_val,
            results_json=json.dumps(results_data.get('results', {})),
            detections_by_zone_json=json.dumps(results_data.get('detections_by_zone', {})),
            original_image_path=results_data.get('original_image'),
            processed_image_path=results_data.get('processed_image'),
            image_size=results_data.get('image_size'),
            zones_available=json.dumps(results_data.get('zones_available', [])),
            synced_to_server=True
        )
        
        db.add(analysis_record)
        db.commit()
        analysis_id = analysis_record.id
        db.close()
        
        print(f"✅ Análisis guardado en DB principal con ID: {analysis_id}")
        return analysis_id, True
        
    except Exception as e:
        print(f"⚠️ Error guardando en DB principal: {e}")
        # Guardar en caché local como fallback
        return save_to_local_cache(analysis_data, form_data, results_data)

def save_to_local_cache(analysis_data, form_data, results_data):
    """Guardar datos en caché local"""
    try:
        local_db = get_local_session()
        
        # Combinar todos los datos
        complete_data = {
            'analysis_data': analysis_data,
            'form_data': form_data,
            'results_data': results_data,
            'timestamp': datetime.utcnow().isoformat(),
            'needs_sync': True
        }
        
        cache_record = LocalCache(
            data_json=json.dumps(complete_data),
            data_type='analysis_result',
            status='pending'
        )
        
        local_db.add(cache_record)
        local_db.commit()
        cache_id = cache_record.id
        local_db.close()
        
        print(f"✅ Análisis guardado en caché local con ID: {cache_id}")
        return cache_id, False
        
    except Exception as e:
        print(f"❌ Error guardando en caché local: {e}")
        return None, False

def get_analysis_history(limit=50, user_name=None, analysis_type=None):
    """Obtener historial de análisis"""
    try:
        db = get_db_session()
        query = db.query(AnalysisResult).order_by(AnalysisResult.timestamp.desc())
        
        if user_name:
            query = query.filter(AnalysisResult.user_name == user_name)
        if analysis_type:
            query = query.filter(AnalysisResult.analysis_type == analysis_type)
            
        results = query.limit(limit).all()
        db.close()
        
        # Convertir a diccionarios
        history = []
        for result in results:
            history.append({
                'id': result.id,
                'timestamp': result.timestamp.isoformat(),
                'user_name': result.user_name,
                'analysis_type': result.analysis_type,
                'profile': result.profile,
                'distribucion': result.distribucion,
                'guia_sii': result.guia_sii,
                'lote': result.lote,
                'num_frutos': result.num_frutos,
                'total_detections': result.total_detections,
                'zones_analyzed': result.zones_analyzed,
                'results': json.loads(result.results_json),
                'processed_image_path': result.processed_image_path,
                'synced': result.synced_to_server
            })
        
        return history
        
    except Exception as e:
        print(f"⚠️ Error obteniendo historial de DB principal: {e}")
        # Intentar obtener del caché local
        return get_local_history(limit)

def get_local_history(limit=50):
    """Obtener historial del caché local"""
    try:
        local_db = get_local_session()
        results = local_db.query(LocalCache)\
            .filter(LocalCache.data_type == 'analysis_result')\
            .order_by(LocalCache.created_at.desc())\
            .limit(limit)\
            .all()
        local_db.close()
        
        history = []
        for result in results:
            data = json.loads(result.data_json)
            form_data = data.get('form_data', {})
            results_data = data.get('results_data', {})
            
            history.append({
                'id': result.id,
                'timestamp': data.get('timestamp'),
                'user_name': form_data.get('user', 'Unknown'),
                'analysis_type': form_data.get('analysis_type', 'unknown'),
                'profile': form_data.get('profile', 'unknown'),
                'distribucion': form_data.get('distribucion', 'unknown'),
                'guia_sii': form_data.get('guia_sii', ''),
                'lote': form_data.get('lote', ''),
                'num_frutos': form_data.get('num_frutos', 0),
                'total_detections': results_data.get('total_cherries', 0),
                'zones_analyzed': results_data.get('zones_loaded', 0),
                'results': results_data.get('results', {}),
                'processed_image_path': results_data.get('processed_image'),
                'synced': result.status == 'synced'
            })
        
        return history
        
    except Exception as e:
        print(f"❌ Error obteniendo historial local: {e}")
        return []

def sync_pending_data():
    """Sincronizar datos pendientes del caché local"""
    try:
        local_db = get_local_session()
        pending_records = local_db.query(LocalCache)\
            .filter(LocalCache.status == 'pending')\
            .all()
        
        if not pending_records:
            local_db.close()
            return {"synced": 0, "errors": 0, "message": "No hay datos pendientes"}
        
        synced_count = 0
        error_count = 0
        
        for record in pending_records:
            try:
                # Intentar sincronizar registro
                data = json.loads(record.data_json)
                form_data = data.get('form_data', {})
                results_data = data.get('results_data', {})
                
                # Guardar en base principal
                analysis_id, success = save_analysis_result(data, form_data, results_data)
                
                if success:
                    # Marcar como sincronizado
                    record.status = 'synced'
                    record.analysis_id = analysis_id
                    record.last_sync_attempt = datetime.utcnow()
                    synced_count += 1
                else:
                    # Incrementar intentos fallidos
                    record.sync_attempts += 1
                    record.last_sync_attempt = datetime.utcnow()
                    if record.sync_attempts >= 3:
                        record.status = 'failed'
                    error_count += 1
                    
            except Exception as e:
                print(f"Error sincronizando registro {record.id}: {e}")
                record.sync_attempts += 1
                record.last_sync_attempt = datetime.utcnow()
                if record.sync_attempts >= 3:
                    record.status = 'failed'
                error_count += 1
        
        local_db.commit()
        local_db.close()
        
        # Registrar sincronización
        try:
            db = get_db_session()
            sync_record = SyncHistory(
                records_synced=synced_count,
                sync_type='manual',
                status='success' if error_count == 0 else 'partial' if synced_count > 0 else 'failed',
                error_message=f"{error_count} errores" if error_count > 0 else None
            )
            db.add(sync_record)
            db.commit()
            db.close()
        except Exception as e:
            print(f"Error registrando sincronización: {e}")
        
        return {
            "synced": synced_count,
            "errors": error_count,
            "message": f"Sincronizados: {synced_count}, Errores: {error_count}"
        }
        
    except Exception as e:
        print(f"❌ Error en sincronización: {e}")
        return {"synced": 0, "errors": 1, "message": str(e)}

# Funciones de usuario
import hashlib
from sqlalchemy.exc import IntegrityError

def hash_password(password):
    """Devuelve hash SHA256 de la contraseña"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def create_user(username, password, role='operador'):
    """Crear un nuevo usuario"""
    db = get_db_session()
    try:
        user = User(
            username=username, 
            password_hash=hash_password(password), 
            role=role
        )
        db.add(user)
        db.commit()
        user_id = user.id
        db.close()
        return {"success": True, "user": username, "role": role, "user_id": user_id}
    except IntegrityError:
        db.rollback()
        db.close()
        return {"success": False, "error": "Usuario ya existe"}
    except Exception as e:
        db.rollback()
        db.close()
        return {"success": False, "error": str(e)}

def authenticate_user(username, password):
    """Autenticar usuario"""
    db = get_db_session()
    try:
        user = db.query(User).filter_by(username=username).first()
        if user and user.password_hash == hash_password(password):
            result = {
                "success": True, 
                "role": user.role, 
                "user_id": user.id,
                "username": user.username
            }
            db.close()
            return result
        db.close()
        return {"success": False, "error": "Credenciales incorrectas"}
    except Exception as e:
        db.close()
        return {"success": False, "error": str(e)}

def get_all_users():
    """Obtener todos los usuarios (solo para admins)"""
    db = get_db_session()
    try:
        users = db.query(User).order_by(User.created_at.desc()).all()
        result = []
        for user in users:
            result.append({
                'id': user.id,
                'username': user.username,
                'role': user.role,
                'created_at': user.created_at.isoformat()
            })
        db.close()
        return result
    except Exception as e:
        db.close()
        print(f"Error obteniendo usuarios: {e}")
        return []

def delete_user(user_id):
    """Eliminar usuario (solo para admins)"""
    db = get_db_session()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if user:
            if user.role == 'admin':
                # Verificar que no sea el único admin
                admin_count = db.query(User).filter_by(role='admin').count()
                if admin_count <= 1:
                    db.close()
                    return {"success": False, "error": "No se puede eliminar el único administrador"}
            
            db.delete(user)
            db.commit()
            db.close()
            return {"success": True, "message": "Usuario eliminado correctamente"}
        else:
            db.close()
            return {"success": False, "error": "Usuario no encontrado"}
    except Exception as e:
        db.rollback()
        db.close()
        return {"success": False, "error": str(e)}

def update_user_role(user_id, new_role):
    """Actualizar rol del usuario"""
    if new_role not in ['admin', 'operador']:
        return {"success": False, "error": "Rol inválido"}
        
    db = get_db_session()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if user:
            if user.role == 'admin' and new_role == 'operador':
                # Verificar que no sea el único admin
                admin_count = db.query(User).filter_by(role='admin').count()
                if admin_count <= 1:
                    db.close()
                    return {"success": False, "error": "No se puede cambiar el rol del único administrador"}
            
            user.role = new_role
            user.updated_at = datetime.utcnow()
            db.commit()
            db.close()
            return {"success": True, "message": "Rol actualizado correctamente"}
        else:
            db.close()
            return {"success": False, "error": "Usuario no encontrado"}
    except Exception as e:
        db.rollback()
        db.close()
        return {"success": False, "error": str(e)}

def create_admin_user():
    """Crear usuario administrador inicial"""
    admin_exists = False
    try:
        db = get_db_session()
        admin_count = db.query(User).filter_by(role='admin').count()
        admin_exists = admin_count > 0
        db.close()
    except:
        pass
    
    if not admin_exists:
        result = create_user('admin', 'admin123', 'admin')
        if result['success']:
            print("✅ Usuario administrador creado: admin / admin123")
        else:
            print(f"⚠️ Error creando admin: {result['error']}")
        return result
    else:
        print("✅ Usuario administrador ya existe")
        return {"success": True, "message": "Admin ya existe"}

def get_defects_for_profile(profile):
    """Obtener lista de defectos disponibles según el perfil"""
    defects_by_profile = {
        'qc_recepcion': [
            'FRUTO DOBLE', 'HIJUELO', 'DAÑO TRIPS', 'DAÑO PLAGA', 'VIROSIS',
            'FRUTO DEFORME', 'HC ESTRELLA', 'RUSSET', 'HC MEDIALUNA', 'HC SATURA',
            'PICADA DE PAJARO', 'HERIDA ABIERTA', 'PUDRICION HUMEDA', 'PUDRICION SECA',
            'FRUTO DESHIDRATADO', 'CRACKING CICATRIZADO', 'SUTURA DE FORMA',
            'FRUTO SIN PEDICELO', 'MACHUCON'
        ],
        'packing_qc': [
            'BANDEJA_1', 'BANDEJA_2', 'BANDEJA_3', 'BANDEJA_4',
            'CONTROL_CALIDAD', 'DESCARTE', 'EMPAQUE_FINAL', 'ETIQUETADO'
        ],
        'contramuestra': [
            'FRUTO DOBLE', 'HIJUELO', 'DAÑO TRIPS', 'DAÑO PLAGA', 'VIROSIS',
            'FRUTO DEFORME', 'HC ESTRELLA', 'RUSSET', 'HC MEDIALUNA', 'HC SATURA',
            'PICADA DE PAJARO', 'HERIDA ABIERTA', 'PUDRICION HUMEDA', 'PUDRICION SECA',
            'FRUTO DESHIDRATADO', 'CRACKING CICATRIZADO', 'SUTURA DE FORMA',
            'FRUTO SIN PEDICELO', 'MACHUCON'
        ]
    }
    
    return defects_by_profile.get(profile, defects_by_profile['qc_recepcion'])

# Inicializar base de datos al importar
if __name__ == "__main__":
    create_tables()
    connection_ok, message = test_db_connection()
    print(f"Estado de conexión: {message}")
