USE BidaShopDB;
GO

IF COL_LENGTH('dbo.users', 'customer_tag') IS NULL
BEGIN
    ALTER TABLE dbo.users ADD customer_tag NVARCHAR(30) NOT NULL CONSTRAINT DF_users_customer_tag DEFAULT 'new';
END
GO

IF OBJECT_ID('dbo.product_reviews', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.product_reviews (
      id INT IDENTITY(1,1) PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      rating INT NOT NULL,
      comment NVARCHAR(MAX) NULL,
      is_visible BIT NOT NULL DEFAULT 1,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.notifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.notifications (
      id INT IDENTITY(1,1) PRIMARY KEY,
      user_id INT NOT NULL,
      coupon_id INT NULL,
      title NVARCHAR(255) NOT NULL,
      message NVARCHAR(MAX) NULL,
      is_read BIT NOT NULL DEFAULT 0,
      sent_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.inventory_receipts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.inventory_receipts (
      id INT IDENTITY(1,1) PRIMARY KEY,
      product_id INT NOT NULL,
      variant_id INT NULL,
      quantity INT NOT NULL,
      note NVARCHAR(500) NULL,
      created_by INT NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_reviews_product' AND object_id = OBJECT_ID('dbo.product_reviews'))
BEGIN
    CREATE INDEX IX_reviews_product ON dbo.product_reviews(product_id, is_visible, created_at DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_notifications_user' AND object_id = OBJECT_ID('dbo.notifications'))
BEGIN
    CREATE INDEX IX_notifications_user ON dbo.notifications(user_id, sent_at DESC);
END
GO
