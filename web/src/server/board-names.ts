import dockerNames from 'docker-names'

// Docker-style board names (adjective_surname, e.g. focused_turing).
// `taken` reports whether a name is already used by another board; after a
// few collisions we follow moby's retry rule and append a number.
export async function uniqueBoardName(taken: (name: string) => Promise<boolean>) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const name = dockerNames.getRandomName(attempt >= 3)
    if (!(await taken(name))) return name
  }
  return `${dockerNames.getRandomName()}_${crypto.randomUUID().slice(0, 4)}`
}
