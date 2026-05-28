import { cleanupE2EData } from "./helpers";

export default async function globalTeardown() {
  await cleanupE2EData();
}
