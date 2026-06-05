import { bigint, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const services = pgTable('services', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  pricing: text('pricing').notNull(),
  requirementsFromCustomer: text('requirements_from_customer').notNull(),
});

export const paymentMethods = pgTable('payment_methods', {
  id: serial('id').primaryKey(),
  name: text('name'),
  accountName: text('account_name'),
  accountNumber: text('account_number'),
  note: text('note'),
});

export const chats = pgTable('chats', {
  id: serial('id').primaryKey(),
  extId: bigint('ext_id', { mode: 'number' }).notNull().unique(),
  name: text('name'),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  chatId: integer('chat_id').references(() => chats.id),
  summary: text('summary'),
});

export const faqs = pgTable('faqs', {
  id: serial('id').primaryKey(),
  question: text('question'),
  answer: text('answer'),
});
