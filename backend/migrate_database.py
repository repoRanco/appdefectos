#!/usr/bin/env python3
"""
Script para migrar la base de datos y agregar columnas faltantes
"""
import os
import sys
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

# Configuración de base de datos
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://lab:password@192.168.1.106:5432/rancoqc')

def migrate_database():
    """Migrar base de datos agregando columnas faltantes"""
    try:
        print("🔧 Iniciando migración de base de datos...")
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        
        with engine.connect() as conn:
            # Verificar si existe la tabla users
            inspector = inspect(engine)
            tables = inspector.get_table_names()
            
            if 'users' not in tables:
                print("❌ Tabla 'users' no existe. Ejecuta create_tables() primero.")
                return False
                
            # Obtener columnas actuales de la tabla users
            columns = [col['name'] for col in inspector.get_columns('users')]
            print(f"📋 Columnas actuales en 'users': {columns}")
            
            # Agregar columna 'role' si no existe
            if 'role' not in columns:
                print("➕ Agregando columna 'role' a tabla 'users'...")
                conn.execute(text("""
                    ALTER TABLE users 
                    ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'operador'
                """))
                conn.commit()
                print("✅ Columna 'role' agregada exitosamente")
            else:
                print("✅ Columna 'role' ya existe")
                
            # Agregar columna 'created_at' si no existe
            if 'created_at' not in columns:
                print("➕ Agregando columna 'created_at' a tabla 'users'...")
                conn.execute(text("""
                    ALTER TABLE users 
                    ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                """))
                conn.commit()
                print("✅ Columna 'created_at' agregada exitosamente")
            else:
                print("✅ Columna 'created_at' ya existe")
                
            # Agregar columna 'updated_at' si no existe
            if 'updated_at' not in columns:
                print("➕ Agregando columna 'updated_at' a tabla 'users'...")
                conn.execute(text("""
                    ALTER TABLE users 
                    ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                """))
                conn.commit()
                print("✅ Columna 'updated_at' agregada exitosamente")
            else:
                print("✅ Columna 'updated_at' ya existe")
                
            # Verificar si existe al menos un administrador
            result = conn.execute(text("SELECT COUNT(*) FROM users WHERE role = 'admin'"))
            admin_count = result.scalar()
            
            if admin_count == 0:
                print("👤 Creando usuario administrador inicial...")
                import hashlib
                password_hash = hashlib.sha256('admin123'.encode('utf-8')).hexdigest()
                
                conn.execute(text("""
                    INSERT INTO users (username, password_hash, role, created_at, updated_at) 
                    VALUES (:username, :password_hash, :role, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (username) DO NOTHING
                """), {
                    'username': 'admin@ranco.cl',
                    'password_hash': password_hash,
                    'role': 'admin'
                })
                conn.commit()
                print("✅ Usuario administrador creado: admin / admin123")
            else:
                print(f"✅ Ya existe {admin_count} administrador(es)")
                
            print("🎉 Migración completada exitosamente!")
            return True
            
    except Exception as e:
        print(f"❌ Error en migración: {e}")
        return False

def reset_users_table():
    """Eliminar y recrear tabla de usuarios (CUIDADO: borra todos los datos)"""
    try:
        print("⚠️  ELIMINANDO tabla 'users' y recreando...")
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        
        with engine.connect() as conn:
            # Eliminar tabla
            conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            conn.commit()
            print("🗑️  Tabla 'users' eliminada")
            
            # Recrear tabla con estructura completa
            conn.execute(text("""
                CREATE TABLE users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(100) UNIQUE NOT NULL,
                    password_hash VARCHAR(256) NOT NULL,
                    role VARCHAR(20) NOT NULL DEFAULT 'operador',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            print("✅ Tabla 'users' recreada con estructura completa")
            
            # Crear usuario admin
            import hashlib
            password_hash = hashlib.sha256('admin123'.encode('utf-8')).hexdigest()
            
            conn.execute(text("""
                INSERT INTO users (username, password_hash, role) 
                VALUES ('admin', :password_hash, 'admin')
            """), {'password_hash': password_hash})
            conn.commit()
            print("✅ Usuario administrador creado: admin / admin123")
            
            return True
            
    except Exception as e:
        print(f"❌ Error reseteando tabla: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Script de migración de base de datos")
    print("1. Migrar (agregar columnas faltantes)")
    print("2. Resetear tabla users (ELIMINA TODOS LOS USUARIOS)")
    print("3. Salir")
    
    choice = input("\nSelecciona una opción (1-3): ").strip()
    
    if choice == '1':
        migrate_database()
    elif choice == '2':
        confirm = input("⚠️  ¿Estás SEGURO de eliminar TODOS los usuarios? (escribir 'SI'): ")
        if confirm == 'SI':
            reset_users_table()
        else:
            print("❌ Operación cancelada")
    elif choice == '3':
        print("👋 Saliendo...")
    else:
        print("❌ Opción inválida")
