-- Employees tablosuna hedef rol sütunu ekleme
ALTER TABLE employees ADD COLUMN IF NOT EXISTS target_role text;
