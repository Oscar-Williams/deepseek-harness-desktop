import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'

const fixture = readFileSync(new URL('./fixtures/permission-settings-rc2.txt', import.meta.url), 'utf8')
const patch = readFileSync(new URL('../src-tauri/src/service/patch/permission_settings.rs', import.meta.url), 'utf8')
const original = patch.match(/const DERIVE_ORIGINAL: &str = r#"([\s\S]*?)"#;/)![1]!
const replacement = patch.match(/const DERIVE_PATCHED: &str = r#"([\s\S]*?)"#;/)![1]!

function harness(patched = true) {
  const view = (revision: number, defaultPreset = 'workspace-write') => ({
    writable: true,
    namespaces: [{ ns: 'permission', revision, value: { defaultPreset } }],
  })
  const mirror = createSnapshotStore({ status: 'ready', error: null, view: view(4) })
  const describeFace = {
    ...mirror,
    ensure: async () => {},
    acceptView: (value: ReturnType<typeof view>) => mirror.update((draft) => { draft.view = value }),
  }
  const catalog = {
    store: createSnapshotStore({
      value: {
        defaultPreset: 'workspace-write',
        defaultOptions: ['workspace-write', 'danger-full-access'].map(value => ({ value, name: value })),
      },
    }),
    load: async () => {},
  }
  const mutate = vi.fn().mockResolvedValue({ ok: false, error: 'configuration changed (expected 4, actual 6)' })
  const Controller = runInNewContext(`${patched ? fixture.replace(original, replacement) : fixture}\nPermissionPresetSettingsController`, {
    _deepseek_ai_dsh_client_store: { createSnapshotStore },
    displayPermissionPreset: (value: string) => value,
    Error,
  }) as new (describeFace: unknown, ctx: unknown, catalog: unknown) => {
    store: { getSnapshot: () => { status: string, error: string | null, currentValue: string, revision: number, writable: boolean } }
    load: () => Promise<void>
    select: (preset: string) => Promise<void>
    dispose: () => void
  }
  const controller = new Controller(describeFace, { remote: { settings: { mutate } } }, catalog)
  return { controller, describeFace, catalog, mutate, view }
}

describe('permission settings error patch', () => {
  it('reproduces upstream clearing a failed save on mirror refresh', async () => {
    const { controller, describeFace, view } = harness(false)
    await controller.load()
    await controller.select('danger-full-access')
    expect(controller.store.getSnapshot().status).toBe('error')
    describeFace.acceptView(view(6))
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
    controller.dispose()
  })

  it('keeps failure visible across mirror and catalog refresh, then accepts a successful save', async () => {
    const { controller, describeFace, catalog, mutate, view } = harness()
    await controller.load()
    await controller.select('danger-full-access')
    expect(mutate).toHaveBeenLastCalledWith('permission', [{
      op: 'set',
      path: ['defaultPreset'],
      value: 'danger-full-access',
    }], 4)
    describeFace.acceptView(view(6))
    catalog.store.update((draft) => {
      draft.value.defaultOptions[0]!.name = 'Workspace'
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'configuration changed (expected 4, actual 6)',
      currentValue: 'workspace-write',
      revision: 6,
      writable: true,
    })

    mutate.mockResolvedValueOnce({ ok: true, value: view(7, 'danger-full-access') })
    await controller.select('danger-full-access')
    expect(mutate.mock.lastCall?.[2]).toBe(6)
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      error: null,
      currentValue: 'danger-full-access',
      revision: 7,
    })
    controller.dispose()
  })
})
