import { ApiError, NoAccessServiceError, type AccessApi, type AccessLevel, type ActivityEvent, type CollectionAccess, type Person, type WhoAmI } from '../src/api'

export const noService = () => ({
  whoami: async () => { throw new NoAccessServiceError() },
} as unknown as AccessApi)

export type FakeApiState = {
  me: WhoAmI
  people: Person[]
  collections: CollectionAccess[]
  events: ActivityEvent[]
  downloads: ActivityEvent[]
}

export const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  email: `${id}@example.org`,
  status: 'active',
  admin: false,
  lastActiveAt: null,
  collections: [],
  ...extra,
})

export function fakeApi(state: Partial<FakeApiState> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const data: FakeApiState = {
    me: { id: 'admin1', name: 'Jorge Delgado', email: 'jorge@example.org', admin: true, collections: [] },
    people: [person('p1', 'Ana Morales'), person('p2', 'Luis Park', { status: 'invited' })],
    collections: [{
      bucket: 'sparcd-aaa',
      uuid: 'aaa',
      name: 'Sky Islands 2026',
      organization: 'Sky Island Alliance',
      members: [{ personId: 'p1', name: 'Ana Morales', access: 'upload', exactLocations: true }],
      membersVersion: 'members-v1',
    }],
    events: [],
    downloads: [],
    ...state,
  }
  let nextToken = 0
  let version = 1
  const record = (name: string, ...args: unknown[]) => calls.push({ name, args })
  const api = {
    async whoami() { record('whoami'); return data.me },
    async listPeople() { record('listPeople'); return data.people },
    async addPerson(input: { name: string; email: string; memberships?: unknown[] }) {
      record('addPerson', input)
      const added = person(`p${data.people.length + 1}`, input.name, { email: input.email, status: 'invited' })
      data.people = [...data.people, added]
      return { person: added, invite: { token: `token-${++nextToken}`, expiresAt: '2026-10-01T00:00:00Z' } }
    },
    async updatePerson(id: string, patch: { status?: 'active' | 'paused' }) {
      record('updatePerson', id, patch)
      data.people = data.people.map((one) => (one.id === id ? { ...one, ...patch } : one))
      return data.people.find((one) => one.id === id)!
    },
    async resetPerson(id: string) {
      record('resetPerson', id)
      data.people = data.people.map((one) => (one.id === id ? { ...one, status: 'invited' } : one))
      return { token: `reset-${++nextToken}`, expiresAt: '2026-10-01T00:00:00Z' }
    },
    async listCollectionAccess() { record('listCollectionAccess'); return data.collections },
    async setMembers(
      bucket: string,
      members: { personId: string; access: string; exactLocations: boolean }[],
      membersVersion: string | null,
    ) {
      record('setMembers', bucket, members, membersVersion)
      const here = data.collections.find((entry) => entry.bucket === bucket)!
      if (membersVersion !== here.membersVersion) {
        throw new ApiError(412, 'changed_elsewhere', 'members changed elsewhere')
      }
      if (!members.some((member) => member.access === 'run')) {
        throw new ApiError(409, 'last_runner', 'at least one member must run it')
      }
      here.members = members.map((member) => ({ ...member, access: member.access as never }))
      here.membersVersion = `members-v${++version}`
      return { members: here.members, membersVersion: here.membersVersion }
    },
    async setMember(bucket: string, personId: string, level: AccessLevel) {
      record('setMember', bucket, personId, level)
      const here = data.collections.find((entry) => entry.bucket === bucket)!
      here.members = [
        ...here.members.filter((member) => member.personId !== personId),
        { personId, name: data.people.find((one) => one.id === personId)?.name, ...level },
      ]
      here.membersVersion = `members-v${++version}`
      return { members: here.members, membersVersion: here.membersVersion }
    },
    async removeMember(bucket: string, personId: string) {
      record('removeMember', bucket, personId)
      const here = data.collections.find((entry) => entry.bucket === bucket)!
      here.members = here.members.filter((member) => member.personId !== personId)
      here.membersVersion = `members-v${++version}`
      return { members: here.members, membersVersion: here.membersVersion }
    },
    async activity() { record('activity'); return { events: data.events } },
    async downloadsOf(bucket: string, key: string) { record('downloadsOf', bucket, key); return data.downloads },
  }
  return { api: api as unknown as AccessApi, calls, data }
}
