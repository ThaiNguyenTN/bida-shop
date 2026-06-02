USE BidaShopDB;
GO

IF COL_LENGTH('dbo.users', 'email_verified_at') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_verified_at DATETIME2 NULL;
END
GO

IF COL_LENGTH('dbo.users', 'email_verification_status') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_verification_status NVARCHAR(30) NOT NULL CONSTRAINT DF_users_email_verification_status DEFAULT 'pending';
END
GO

IF COL_LENGTH('dbo.users', 'email_otp_hash') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_hash NVARCHAR(255) NULL;
END
GO

IF COL_LENGTH('dbo.users', 'email_otp_expires_at') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_expires_at DATETIME2 NULL;
END
GO

IF COL_LENGTH('dbo.users', 'email_otp_last_sent_at') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_last_sent_at DATETIME2 NULL;
END
GO

IF COL_LENGTH('dbo.users', 'email_otp_attempt_count') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_attempt_count INT NOT NULL CONSTRAINT DF_users_email_otp_attempt_count DEFAULT 0;
END
GO

UPDATE dbo.users
SET email_verification_status = CASE WHEN email_verified = 1 THEN 'verified' ELSE 'pending' END
WHERE email_verification_status IS NULL OR email_verification_status = '';
GO

IF COL_LENGTH('dbo.orders', 'payment_provider') IS NULL
BEGIN
    ALTER TABLE dbo.orders ADD payment_provider NVARCHAR(30) NULL;
END
GO

IF COL_LENGTH('dbo.orders', 'payment_ref') IS NULL
BEGIN
    ALTER TABLE dbo.orders ADD payment_ref NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('dbo.orders', 'payment_requested_at') IS NULL
BEGIN
    ALTER TABLE dbo.orders ADD payment_requested_at DATETIME2 NULL;
END
GO

IF COL_LENGTH('dbo.orders', 'paid_at') IS NULL
BEGIN
    ALTER TABLE dbo.orders ADD paid_at DATETIME2 NULL;
END
GO

IF COL_LENGTH('dbo.orders', 'payment_failure_reason') IS NULL
BEGIN
    ALTER TABLE dbo.orders ADD payment_failure_reason NVARCHAR(500) NULL;
END
GO

IF COL_LENGTH('dbo.payment_transactions', 'txn_ref') IS NULL
BEGIN
    ALTER TABLE dbo.payment_transactions ADD txn_ref NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('dbo.payment_transactions', 'event_type') IS NULL
BEGIN
    ALTER TABLE dbo.payment_transactions ADD event_type NVARCHAR(30) NULL;
END
GO

IF COL_LENGTH('dbo.payment_transactions', 'checksum_valid') IS NULL
BEGIN
    ALTER TABLE dbo.payment_transactions ADD checksum_valid BIT NULL;
END
GO

IF COL_LENGTH('dbo.payment_transactions', 'response_code') IS NULL
BEGIN
    ALTER TABLE dbo.payment_transactions ADD response_code NVARCHAR(30) NULL;
END
GO

IF COL_LENGTH('dbo.payment_transactions', 'transaction_status') IS NULL
BEGIN
    ALTER TABLE dbo.payment_transactions ADD transaction_status NVARCHAR(30) NULL;
END
GO

IF COL_LENGTH('dbo.payment_transactions', 'processed_at') IS NULL
BEGIN
    ALTER TABLE dbo.payment_transactions ADD processed_at DATETIME2 NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_payment_transactions_order_provider' AND object_id = OBJECT_ID('dbo.payment_transactions'))
BEGIN
    CREATE INDEX IX_payment_transactions_order_provider ON dbo.payment_transactions(order_id, provider, created_at DESC);
END
GO
