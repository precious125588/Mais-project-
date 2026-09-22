// ESM loader stub for @whiskeysockets/baileys — lets universalButtons
// perform its actual import path and then exercise the
// relayMessage-fail branch without needing the real Baileys dep.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@whiskeysockets/baileys") {
    return { url: new URL("./baileys-stub.js", import.meta.url).href, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}
