import { executeBatch } from '../../lib/db.js';

const ensureUsersEmailVerificationSql = `
IF COL_LENGTH('dbo.users', 'email_verified_at') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_verified_at DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.users', 'email_verification_status') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_verification_status NVARCHAR(30) NOT NULL CONSTRAINT DF_users_email_verification_status DEFAULT 'pending';
END;

IF COL_LENGTH('dbo.users', 'email_otp_hash') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_hash NVARCHAR(255) NULL;
END;

IF COL_LENGTH('dbo.users', 'email_otp_expires_at') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_expires_at DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.users', 'email_otp_last_sent_at') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_last_sent_at DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.users', 'email_otp_attempt_count') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD email_otp_attempt_count INT NOT NULL CONSTRAINT DF_users_email_otp_attempt_count DEFAULT 0;
END;

UPDATE dbo.users
SET email_verification_status = CASE WHEN email_verified = 1 THEN 'verified' ELSE 'pending' END
WHERE email_verification_status IS NULL OR email_verification_status = '';
`;

let ensureSchemaPromise = null;

export async function ensureEmailVerificationSchema() {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = executeBatch(ensureUsersEmailVerificationSql).catch((error) => {
      ensureSchemaPromise = null;
      throw error;
    });
  }
  return ensureSchemaPromise;
}
