import fs from "node:fs";

/** Lets plain Node resolve the app's extensionless TypeScript imports. */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    for (const candidate of [`${base.href}.ts`, `${base.href}/index.ts`]) {
      if (fs.existsSync(new URL(candidate))) return next(candidate, context);
    }
  }
  return next(specifier, context);
}
