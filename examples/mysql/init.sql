CREATE DATABASE IF NOT EXISTS mcp_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mcp_demo;

CREATE TABLE customers (
  id INT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  city VARCHAR(80) NOT NULL
);

CREATE TABLE orders (
  id INT PRIMARY KEY,
  customer_id INT NOT NULL,
  ordered_on DATE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'paid', 'cancelled') NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

INSERT INTO customers VALUES
  (1, '陈晨', '杭州'),
  (2, '林晓', '上海'),
  (3, '赵宁', '成都'),
  (4, '周航', '深圳');

INSERT INTO orders VALUES
  (101, 1, '2026-01-05', 129.90, 'paid'),
  (102, 1, '2026-01-14', 59.00, 'paid'),
  (103, 2, '2026-01-18', 249.00, 'pending'),
  (104, 2, '2026-02-02', 88.50, 'cancelled'),
  (105, 3, '2026-02-07', 329.00, 'paid'),
  (106, 3, '2026-02-10', 45.00, 'pending');

CREATE USER 'mcp_reader'@'%' IDENTIFIED BY 'change-me';
GRANT SELECT ON mcp_demo.* TO 'mcp_reader'@'%';
