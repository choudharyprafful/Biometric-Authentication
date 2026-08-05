import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Records explicit consent for a narrowly-defined, de-identified training
 * contribution. This table must never contain source conversations, biometrics,
 * payment data, or any other training payload.
 */
export const trainingConsentsTable = pgTable("training_consents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  optedIn: boolean("opted_in").notNull().default(false),
  purpose: text("purpose").notNull().default("Model quality research using de-identified, approved feedback only."),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * Dataset metadata and lineage only. No raw user data is stored here.
 */
export const trainingDatasetsTable = pgTable("training_datasets", {
  id: serial("id").primaryKey(),
  version: text("version").notNull().unique(),
  purpose: text("purpose").notNull(),
  dataCategories: jsonb("data_categories").notNull().$type<string[]>(),
  contributorCount: integer("contributor_count").notNull().default(0),
  deidentificationStatus: text("deidentification_status").notNull().default("verified"),
  status: text("status", { enum: ["active", "retired"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Links a deployed/training model version to the metadata-only dataset version
 * used to produce it, enabling impact analysis on deletion requests.
 */
export const modelTrainingRunsTable = pgTable("model_training_runs", {
  id: serial("id").primaryKey(),
  modelVersion: text("model_version").notNull().unique(),
  datasetVersion: text("dataset_version").notNull(),
  status: text("status", { enum: ["training", "deployed", "retired"] }).notNull().default("deployed"),
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes").notNull().default(""),
});

/**
 * A deletion request is deliberately tracked through source removal and model
 * impact assessment. It makes the limit explicit: existing model versions
 * require retraining before they can be claimed to exclude the contribution.
 */
export const trainingDeletionRequestsTable = pgTable("training_deletion_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  status: text("status", {
    enum: ["source_removed", "retraining_required", "retrained"],
  }).notNull().default("source_removed"),
  affectedModelVersions: jsonb("affected_model_versions").notNull().$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});