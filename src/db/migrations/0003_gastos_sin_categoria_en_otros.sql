-- Los gastos e ingresos guardados sin elegir categoría pasan a "Otros" (clave `other`), que es
-- como ya se mostraban. Desde esta versión, los repositorios guardan Otros por omisión.
-- Solo cambia `category_id`: estos datos todavía no se sincronizan.
UPDATE `expenses` SET `category_id` = '0199c82c-c000-7000-8000-000000000009' WHERE `category_id` IS NULL;
