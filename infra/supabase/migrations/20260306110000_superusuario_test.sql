-- =============================================================================
-- Migración: Superusuario de test
-- Ejecutar DESPUÉS de haber creado el usuario en Supabase Auth con:
--   Email:      demo@irpf-parser.dev
--   Contraseña: Demo2025!
-- =============================================================================

-- Paso 1: Crear el usuario en Supabase Auth (ejecutar vía Dashboard > Auth > Users
--         o vía la API de administración de Supabase)
-- Este script asume que el usuario ya existe en auth.users y obtiene su UUID.

-- Paso 2: Insertar el abogado en abogados_despacho con rol socio
-- El UUID se obtiene dinámicamente desde auth.users para evitar hardcoding.

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Obtener el UUID del usuario demo recién creado en Supabase Auth
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'demo@irpf-parser.dev'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Usuario demo@irpf-parser.dev no encontrado en auth.users. Crea el usuario primero en Supabase Dashboard > Authentication > Users.';
    RETURN;
  END IF;

  -- Insertar o actualizar el registro en abogados_despacho
  INSERT INTO abogados_despacho (auth_user_id, nombre, rol, activo)
  VALUES (v_user_id, 'Demo Superusuario', 'socio', true)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET nombre = EXCLUDED.nombre,
        rol    = EXCLUDED.rol,
        activo = EXCLUDED.activo;

  RAISE NOTICE 'Superusuario demo registrado con UUID: %', v_user_id;
END;
$$;

-- Verificación: mostrar el registro creado
SELECT
  a.auth_user_id,
  u.email,
  a.nombre,
  a.rol,
  a.activo,
  a.created_at
FROM abogados_despacho a
JOIN auth.users u ON u.id = a.auth_user_id
WHERE u.email = 'demo@irpf-parser.dev';
