import { cleanE2eData } from "./clean";

/** After the browser tests: remove the test people and firms again. */
export default async function globalTeardown() {
  await cleanE2eData();
}
