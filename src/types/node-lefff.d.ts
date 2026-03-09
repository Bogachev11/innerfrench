declare module "node-lefff" {
  interface Lemmatizer {
    lem(word: string): string;
  }
  function load(): Promise<Lemmatizer>;
  export default { load };
}
