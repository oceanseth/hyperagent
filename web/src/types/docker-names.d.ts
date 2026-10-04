declare module 'docker-names' {
  const dockerNames: {
    adjectives: string[]
    surnames: string[]
    getRandomName(appendNumber?: boolean | number): string
  }
  export default dockerNames
}
