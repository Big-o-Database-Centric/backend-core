-- ============================================
-- Database-Centric Platform - Auth Module
-- SQL Server Scripts (Stored Procedures)
-- ============================================
-- Descripción: SPs para autenticación OAuth2
-- Autor: DB Team
-- Nota: TODA la lógica de negocio va aquí.
--       El backend solo invoca SPs con parámetros.
-- ============================================

USE [database_centric_platform];
GO

-- ============================================
-- Tablas
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
BEGIN
    CREATE TABLE Users (
        user_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        email NVARCHAR(255) NULL,
        name NVARCHAR(255) NULL,
        avatar NVARCHAR(500) NULL,
        provider NVARCHAR(50) NOT NULL,
        provider_account_id NVARCHAR(255) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        last_login_at DATETIME2 NULL,
        CONSTRAINT UX_Users_ProviderAccountId UNIQUE (provider, provider_account_id),
        CONSTRAINT UX_Users_Email UNIQUE (email)
    );

    CREATE INDEX IX_Users_Email ON Users(email) WHERE email IS NOT NULL;
    CREATE INDEX IX_Users_Provider ON Users(provider);
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuthSessions')
BEGIN
    CREATE TABLE AuthSessions (
        session_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        user_id UNIQUEIDENTIFIER NOT NULL,
        provider NVARCHAR(50) NOT NULL,
        ip_address NVARCHAR(45) NULL,
        user_agent NVARCHAR(500) NULL,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        expires_at DATETIME2 NOT NULL,
        revoked_at DATETIME2 NULL,
        CONSTRAINT FK_Sessions_Users FOREIGN KEY (user_id) REFERENCES Users(user_id)
    );

    CREATE INDEX IX_Sessions_UserId ON AuthSessions(user_id);
    CREATE INDEX IX_Sessions_ExpiresAt ON AuthSessions(expires_at);
    CREATE INDEX IX_Sessions_Revoked ON AuthSessions(revoked_at) WHERE revoked_at IS NULL;
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditLogs')
BEGIN
    CREATE TABLE AuditLogs (
        audit_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        user_id UNIQUEIDENTIFIER NULL,
        action NVARCHAR(100) NOT NULL,
        target NVARCHAR(255) NULL,
        ip_address NVARCHAR(45) NULL,
        details NVARCHAR(MAX) NULL,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_Audit_Users FOREIGN KEY (user_id) REFERENCES Users(user_id)
    );

    CREATE INDEX IX_Audit_UserId ON AuditLogs(user_id);
    CREATE INDEX IX_Audit_Action ON AuditLogs(action);
    CREATE INDEX IX_Audit_CreatedAt ON AuditLogs(created_at);
END
GO

-- ============================================
-- Stored Procedure: sp_UpsertOAuthUser
-- ============================================
-- Descripción: Inserta o actualiza un usuario OAuth.
--              Si el usuario existe por (provider, provider_account_id),
--              actualiza nombre/avatar y retorna el registro.
--              Si no existe, lo crea con nuevo user_id.
-- Parámetros:
--   @email NVARCHAR(255)
--   @name NVARCHAR(255)
--   @avatar NVARCHAR(500)
--   @provider NVARCHAR(50)
--   @provider_account_id NVARCHAR(255)
-- Retorna:
--   Filas del usuario (user_id, email, name, avatar, provider, provider_account_id, created_at, last_login_at)
-- ============================================

IF OBJECT_ID('sp_UpsertOAuthUser', 'P') IS NOT NULL DROP PROCEDURE sp_UpsertOAuthUser;
GO

CREATE PROCEDURE sp_UpsertOAuthUser
    @email NVARCHAR(255) = NULL,
    @name NVARCHAR(255) = NULL,
    @avatar NVARCHAR(500) = NULL,
    @provider NVARCHAR(50),
    @provider_account_id NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @userId UNIQUEIDENTIFIER;
    DECLARE @isNewUser BIT = 0;

    -- Buscar usuario existente
    SELECT @userId = user_id, @isNewUser = 1
    FROM Users
    WHERE provider = @provider AND provider_account_id = @provider_account_id;

    IF @userId IS NULL
    BEGIN
        -- Usuario nuevo
        SET @userId = NEWSEQUENTIALID();
        SET @isNewUser = 0;

        INSERT INTO Users (user_id, email, name, avatar, provider, provider_account_id, created_at, last_login_at)
        VALUES (@userId, @email, @name, @avatar, @provider, @provider_account_id, GETUTCDATE(), GETUTCDATE());
    END
    ELSE
    BEGIN
        -- Usuario existente: actualizar datos y last_login
        UPDATE Users
        SET
            email = COALESCE(@email, email),
            name = COALESCE(@name, name),
            avatar = COALESCE(@avatar, avatar),
            last_login_at = GETUTCDATE()
        WHERE user_id = @userId;
    END

    -- Retornar usuario
    SELECT
        user_id,
        email,
        name,
        avatar,
        provider,
        provider_account_id,
        created_at,
        last_login_at
    FROM Users
    WHERE user_id = @userId;
END
GO

-- ============================================
-- Stored Procedure: sp_FindUserByProvider
-- ============================================
-- Descripción: Busca un usuario por proveedor y provider_account_id.
-- Parámetros:
--   @provider NVARCHAR(50)
--   @provider_account_id NVARCHAR(255)
-- Retorna:
--   Usuario si existe, NULL si no.
-- ============================================

IF OBJECT_ID('sp_FindUserByProvider', 'P') IS NOT NULL DROP PROCEDURE sp_FindUserByProvider;
GO

CREATE PROCEDURE sp_FindUserByProvider
    @provider NVARCHAR(50),
    @provider_account_id NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        user_id,
        email,
        name,
        avatar,
        provider,
        provider_account_id,
        created_at,
        last_login_at
    FROM Users
    WHERE provider = @provider AND provider_account_id = @provider_account_id;
END
GO

-- ============================================
-- Stored Procedure: sp_FindUserById
-- ============================================
-- Descripción: Busca un usuario por user_id.
-- Parámetros:
--   @user_id UNIQUEIDENTIFIER
-- Retorna:
--   Usuario si existe, NULL si no.
-- ============================================

IF OBJECT_ID('sp_FindUserById', 'P') IS NOT NULL DROP PROCEDURE sp_FindUserById;
GO

CREATE PROCEDURE sp_FindUserById
    @user_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        user_id,
        email,
        name,
        avatar,
        provider,
        provider_account_id,
        created_at,
        last_login_at
    FROM Users
    WHERE user_id = @user_id;
END
GO

-- ============================================
-- Stored Procedure: sp_UpdateLastLogin
-- ============================================
-- Descripción: Actualiza last_login_at del usuario.
-- Parámetros:
--   @user_id UNIQUEIDENTIFIER
-- Retorna:
--   Nada (solo actualiza).
-- ============================================

IF OBJECT_ID('sp_UpdateLastLogin', 'P') IS NOT NULL DROP PROCEDURE sp_UpdateLastLogin;
GO

CREATE PROCEDURE sp_UpdateLastLogin
    @user_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Users
    SET last_login_at = GETUTCDATE()
    WHERE user_id = @user_id;
END
GO

-- ============================================
-- Stored Procedure: sp_CreateSession
-- ============================================
-- Descripción: Crea una nueva sesión de autenticación.
-- Parámetros:
--   @user_id UNIQUEIDENTIFIER
--   @provider NVARCHAR(50)
--   @ip_address NVARCHAR(45)
--   @user_agent NVARCHAR(500)
--   @expires_at DATETIME2
-- Retorna:
--   session_id (output) y datos de la sesión.
-- ============================================

IF OBJECT_ID('sp_CreateSession', 'P') IS NOT NULL DROP PROCEDURE sp_CreateSession;
GO

CREATE PROCEDURE sp_CreateSession
    @user_id UNIQUEIDENTIFIER,
    @provider NVARCHAR(50),
    @ip_address NVARCHAR(45) = NULL,
    @user_agent NVARCHAR(500) = NULL,
    @expires_at DATETIME2,
    @session_id_output UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    SET @session_id_output = NEWSEQUENTIALID();

    INSERT INTO AuthSessions (session_id, user_id, provider, ip_address, user_agent, created_at, expires_at)
    VALUES (@session_id_output, @user_id, @provider, @ip_address, @user_agent, GETUTCDATE(), @expires_at);

    SELECT
        session_id,
        user_id,
        provider,
        ip_address,
        user_agent,
        created_at,
        expires_at
    FROM AuthSessions
    WHERE session_id = @session_id_output;
END
GO

-- ============================================
-- Stored Procedure: sp_FindSession
-- ============================================
-- Descripción: Busca una sesión activa por session_id.
-- Parámetros:
--   @session_id UNIQUEIDENTIFIER
-- Retorna:
--   Sesión si existe y no está revocada/expirada.
-- ============================================

IF OBJECT_ID('sp_FindSession', 'P') IS NOT NULL DROP PROCEDURE sp_FindSession;
GO

CREATE PROCEDURE sp_FindSession
    @session_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        session_id,
        user_id,
        provider,
        ip_address,
        user_agent,
        created_at,
        expires_at
    FROM AuthSessions
    WHERE session_id = @session_id
      AND revoked_at IS NULL
      AND expires_at > GETUTCDATE();
END
GO

-- ============================================
-- Stored Procedure: sp_RevokeSession
-- ============================================
-- Descripción: Revoca una sesión (logout).
-- Parámetros:
--   @session_id UNIQUEIDENTIFIER
-- Retorna:
--   Nada (solo actualiza).
-- ============================================

IF OBJECT_ID('sp_RevokeSession', 'P') IS NOT NULL DROP PROCEDURE sp_RevokeSession;
GO

CREATE PROCEDURE sp_RevokeSession
    @session_id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE AuthSessions
    SET revoked_at = GETUTCDATE()
    WHERE session_id = @session_id;
END
GO

-- ============================================
-- Stored Procedure: sp_LogAudit
-- ============================================
-- Descripción: Registra un evento de auditoría.
-- Parámetros:
--   @user_id UNIQUEIDENTIFIER
--   @action NVARCHAR(100)
--   @target NVARCHAR(255)
--   @ip_address NVARCHAR(45)
--   @details NVARCHAR(MAX)
-- Retorna:
--   Nada (solo inserta).
-- ============================================

IF OBJECT_ID('sp_LogAudit', 'P') IS NOT NULL DROP PROCEDURE sp_LogAudit;
GO

CREATE PROCEDURE sp_LogAudit
    @user_id UNIQUEIDENTIFIER = NULL,
    @action NVARCHAR(100),
    @target NVARCHAR(255) = NULL,
    @ip_address NVARCHAR(45) = NULL,
    @details NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO AuditLogs (user_id, action, target, ip_address, details, created_at)
    VALUES (@user_id, @action, @target, @ip_address, @details, GETUTCDATE());
END
GO

-- ============================================
-- Views para métricas (Landing Page)
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_PlatformMetrics')
BEGIN
    EXEC('
    CREATE VIEW vw_PlatformMetrics
    AS
    SELECT
        (SELECT COUNT(*) FROM Users) AS total_users,
        (SELECT COUNT(*) FROM Users WHERE last_login_at >= DATEADD(DAY, -7, GETUTCDATE())) AS active_users,
        (SELECT COUNT(*) FROM AuthSessions WHERE revoked_at IS NULL AND expires_at > GETUTCDATE()) AS active_sessions,
        (SELECT COUNT(*) FROM AuditLogs WHERE action = ''LOGIN'' AND created_at >= DATEADD(DAY, -1, GETUTCDATE())) AS logins_last_24h,
        GETUTCDATE() AS snapshot_at
    ');
END
GO

-- ============================================
-- Función: fn_GetUserMetrics
-- ============================================

IF OBJECT_ID('fn_GetUserMetrics', 'IF') IS NOT NULL DROP FUNCTION fn_GetUserMetrics;
GO

CREATE FUNCTION fn_GetUserMetrics(@user_id UNIQUEIDENTIFIER)
RETURNS TABLE
AS
RETURN
(
    SELECT
        u.user_id,
        u.email,
        u.name,
        COUNT(DISTINCT s.session_id) AS total_sessions,
        COUNT(DISTINCT CASE WHEN s.revoked_at IS NULL AND s.expires_at > GETUTCDATE() THEN s.session_id END) AS active_sessions,
        COUNT(DISTINCT a.audit_id) AS total_audit_logs,
        MAX(s.created_at) AS last_session_at,
        MAX(a.created_at) AS last_activity_at
    FROM Users u
    LEFT JOIN AuthSessions s ON u.user_id = s.user_id
    LEFT JOIN AuditLogs a ON u.user_id = a.user_id
    WHERE u.user_id = @user_id
    GROUP BY u.user_id, u.email, u.name
);
GO

-- ============================================
-- Seed de datos de prueba (opcional)
-- ============================================

-- Ejecutar solo en desarrollo:
-- EXEC sp_LogAudit NULL, 'SYSTEM', 'INIT', NULL, 'Database initialized';
-- SELECT * FROM vw_PlatformMetrics;