// Minimal Baileys stub — only the symbols universalButtons actually
// touches. Anything else returns undefined and the code path takes the
// fallback branch that's the whole point of the test.
export const proto = {
  Message: {
    InteractiveMessage: {
      create: () => ({}),
      Body:   { create: x => x },
      Footer: { create: x => x },
      Header: { create: x => x },
      NativeFlowMessage: { create: x => x },
    },
  },
};
export const generateWAMessageFromContent = async () => ({ key: { id: "WAM_stub" }, message: {} });
