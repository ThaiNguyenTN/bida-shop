IF OBJECT_ID('cart_items', 'U') IS NULL
BEGIN
  CREATE TABLE cart_items (
    id INT IDENTITY(1,1) PRIMARY KEY,
    cart_id INT NOT NULL,
    product_id INT NOT NULL,
    variant_id INT NULL,
    quantity INT NOT NULL DEFAULT 1,
    selected_services NVARCHAR(MAX) NULL,
    unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
    is_selected BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('carts', 'U') IS NULL
BEGIN
  CREATE TABLE carts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NULL,
    guest_token NVARCHAR(100) NULL,
    status NVARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF COL_LENGTH('cart_items', 'is_selected') IS NULL
BEGIN
  ALTER TABLE cart_items ADD is_selected BIT NOT NULL CONSTRAINT DF_cart_items_is_selected DEFAULT 1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_carts_user_status' AND object_id = OBJECT_ID('carts'))
BEGIN
  CREATE INDEX IX_carts_user_status ON carts(user_id, status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_carts_guest_status' AND object_id = OBJECT_ID('carts'))
BEGIN
  CREATE INDEX IX_carts_guest_status ON carts(guest_token, status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cart_items_cart_id' AND object_id = OBJECT_ID('cart_items'))
BEGIN
  CREATE INDEX IX_cart_items_cart_id ON cart_items(cart_id);
END
GO
