USE BidaShopDB;
GO

IF COL_LENGTH('dbo.orders', 'rewarded_points') IS NULL
BEGIN
    ALTER TABLE dbo.orders ADD rewarded_points INT NOT NULL CONSTRAINT DF_orders_rewarded_points DEFAULT 0;
END
GO

IF COL_LENGTH('dbo.product_reviews', 'order_item_id') IS NULL
BEGIN
    ALTER TABLE dbo.product_reviews ADD order_item_id INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_product_reviews_order_item' AND object_id = OBJECT_ID('dbo.product_reviews'))
BEGIN
    CREATE INDEX IX_product_reviews_order_item ON dbo.product_reviews(order_item_id, user_id);
END
GO
