declare module "*.json" {
  const value: Record<string, { message: string }>;
  export default value;
}

// Only reached through type imports of the extension's shared code; never bundled.
declare module "@plasmohq/storage";
declare module "plasmo" {
  export type PlasmoCSConfig = Record<string, unknown>;
}
