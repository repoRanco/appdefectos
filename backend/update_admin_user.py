#!/usr/bin/env python3
"""
Script para actualizar el usuario administrador a admin@ranco.cl
"""
import os
import hashlib
from sqlalchemy import create_engine, text

# Configuración de base de datos
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://lab:password@192.168.1.106:5432/rancoqc')

def update_admin_user():
    """Actualizar usuario administrador a admin@ranco.cl"""
    try:
        print("🔧 Actualizando usuario administrador...")
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        
        password_hash = hashlib.sha256('admin123'.encode('utf-8')).hexdigest()
        
        with engine.connect() as conn:
            # Verificar usuarios admin actuales
            result = conn.execute(text("SELECT id, username, role FROM users WHERE role = 'admin'"))
            admins = result.fetchall()
            
            print(f"📋 Administradores actuales: {len(admins)}")
            for admin in admins:
                print(f"   - ID: {admin[0]}, Usuario: {admin[1]}, Rol: {admin[2]}")
            
            # Actualizar o crear admin@ranco.cl
            conn.execute(text("""
                INSERT INTO users (username, password_hash, role, created_at, updated_at) 
                VALUES (:username, :password_hash, :role, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (username) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    role = EXCLUDED.role,
                    updated_at = CURRENT_TIMESTAMP
            """), {
                'username': 'admin@ranco.cl',
                'password_hash': password_hash,
                'role': 'admin'
            })
            conn.commit()
            
            # Verificar el resultado
            result = conn.execute(text("SELECT id, username, role FROM users WHERE username = 'admin@ranco.cl'"))
            new_admin = result.fetchone()
            
            if new_admin:
                print(f"✅ Usuario administrador actualizado:")
                print(f"   - ID: {new_admin[0]}")
                print(f"   - Usuario: {new_admin[1]}")
                print(f"   - Contraseña: admin123")
                print(f"   - Rol: {new_admin[2]}")
                return True
            else:
                print("❌ No se pudo crear/actualizar el administrador")
                return False
            
    except Exception as e:
        print(f"❌ Error actualizando admin: {e}")
        return False

if __name__ == "__main__":
    update_admin_user()
