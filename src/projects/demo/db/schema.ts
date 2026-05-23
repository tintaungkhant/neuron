import { pgTable, serial, text } from 'drizzle-orm/pg-core';

export const services = pgTable('services', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  pricing: text('pricing').notNull(),
  requirementsFromCustomer: text('requirements_from_customer').notNull(),
});
