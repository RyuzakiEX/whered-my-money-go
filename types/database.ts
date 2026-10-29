// Hand-written barrel over the generated database types.
//
// Application code imports from '@/types/database', never from
// './database.types' directly. The generated file's shape is the CLI's to
// change between versions; this file is the one place that absorbs it.
//
// These are DATABASE ROW types. Domain types live in lib/core/types.ts, and
// lib/server/mappers/ converts between the two — see
// docs/architecture/source-structure.md.

export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './database.types';

export { Constants } from './database.types';
