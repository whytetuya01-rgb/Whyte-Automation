import type { mongo } from "mongoose";

/**
 * Wraps a MongoDB `Db` so that ANY write or schema-changing call throws.
 * The migration dry-run is handed this wrapper instead of the real handle, so
 * "makes no database writes" is enforced by construction rather than by the
 * planner merely being careful.
 */
const WRITE_METHODS = new Set([
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "bulkWrite",
  "drop",
  "rename",
  "createIndex",
  "createIndexes",
  "dropIndex",
  "dropIndexes",
]);

const WRITE_STAGES = ["$out", "$merge"];

export class ReadOnlyViolationError extends Error {
  constructor(operation: string) {
    super(`Dry-run attempted a database write (${operation}); refusing.`);
    this.name = "ReadOnlyViolationError";
  }
}

function guardCollection(collection: mongo.Collection<any>): mongo.Collection<any> {
  return new Proxy(collection, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
        return () => {
          throw new ReadOnlyViolationError(`${target.collectionName}.${prop}`);
        };
      }
      if (prop === "aggregate") {
        return (pipeline: Array<Record<string, unknown>>, ...rest: unknown[]) => {
          if (pipeline.some((stage) => WRITE_STAGES.some((w) => w in stage))) {
            throw new ReadOnlyViolationError(`${target.collectionName}.aggregate(${WRITE_STAGES.join("|")})`);
          }
          return (target.aggregate as (...a: unknown[]) => unknown)(pipeline, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function readOnlyDb(db: mongo.Db): mongo.Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "collection") {
        return (name: string, ...rest: unknown[]) =>
          guardCollection((target.collection as (...a: unknown[]) => mongo.Collection<any>)(name, ...rest));
      }
      if (prop === "dropCollection" || prop === "dropDatabase" || prop === "createCollection" || prop === "renameCollection") {
        return () => {
          throw new ReadOnlyViolationError(String(prop));
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
