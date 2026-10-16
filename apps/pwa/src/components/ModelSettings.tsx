import { useEffect, useState } from 'react'
import type { PublicConfig } from '../state/useServerConfig'
import { type ConfigPatch, useModelTools } from '../state/useServerConfig'
import { ButtonLabel } from './Spinner'
import { Field, ModelPicker, buttonClass, inputClass, primaryButtonClass } from './SettingsBits'

export interface ModelServerConfig {
  config: PublicConfig | null
  providers: Array<{
    id: string
    name: string
    kind: string
    baseUrl: string
    noEmbeddings: boolean
  }>
  loaded: boolean
  saving: boolean
  error: string | null
  save: (patch: ConfigPatch) => Promise<boolean>
}

/**
 * Which model the server uses.
 *
 * On the admin screen rather than in each person's settings, because it is one model for
 * the whole server: it runs there, it holds the keys, and every account is asking the same
 * process. A per-account copy of a server-wide fact was two places to change one thing, and
 * it meant anybody with an account could point the server at an address of their choosing.
 */
export function ModelSettings({
  serverConfig,
  serverUrl,
  modelStatus,
  onRefreshModel,
}: {
  serverConfig: ModelServerConfig
  serverUrl: string
  /** What the server reports about the model it is actually using. */
  modelStatus: {
    baseUrl: string | null
    embedBaseUrl: string | null
  } | null
  onRefreshModel: () => Promise<void>
}) {
  const { config, providers, loaded, saving, error, save } = serverConfig
  const modelTools = useModelTools(serverUrl)

  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [embedBaseUrl, setEmbedBaseUrl] = useState('')
  const [embedProvider, setEmbedProvider] = useState('')
  const [embedModel, setEmbedModel] = useState('')
  const [embedApiKey, setEmbedApiKey] = useState('')
  const [similarity, setSimilarity] = useState('')

  const [chatModels, setChatModels] = useState<string[]>([])
  const [embedModels, setEmbedModels] = useState<string[]>([])
  const [customChat, setCustomChat] = useState(false)
  const [customEmbed, setCustomEmbed] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!config) return
    setProvider(config.provider ?? '')
    setModel(config.model ?? '')
    setEmbedProvider(config.embedProvider ?? '')
    setEmbedModel(config.embedModel ?? '')
    setSimilarity(config.embedSimilarity === null ? '' : String(config.embedSimilarity))
    setBaseUrl(config.baseUrl ?? '')
    setEmbedBaseUrl(config.embedBaseUrl ?? '')
  }, [config])

  async function loadModels(kind: 'chat' | 'embed', quiet = false) {
    const result = await modelTools.loadModels(kind)
    if (result.ok && result.models) {
      if (kind === 'chat') setChatModels(result.models)
      else setEmbedModels(result.models)
      if (!quiet) {
        setNote({
          ok: true,
          text:
            result.models.length === 0
              ? 'the provider listed no models'
              : `${result.models.length} models — choose one below`,
        })
      }
    } else if (!quiet) {
      setNote({ ok: false, text: result.error ?? 'could not list models' })
    }
  }

  // Load the list as soon as the screen knows which provider is saved, so a dropdown is
  // simply there rather than something you have to go and ask for.
  const providerKey = `${config?.provider ?? ''}|${config?.embedProvider ?? ''}`
  useEffect(() => {
    if (!config) return
    void loadModels('chat', true)
    if (config.embedProvider) void loadModels('embed', true)
    // loadModels is stable enough; keyed on the saved providers on purpose.
  }, [providerKey])

  /**
   * Save the form, before Load or Test get to use it.
   *
   * Both of those read the server's *saved* settings, so pasting a key and pressing Load
   * answered "no model configured" — true, and no help at all. Saving first is what
   * pressing Load was meant to do.
   */
  async function persist(): Promise<boolean> {
    const patch: Record<string, string | number | null> = {
      provider,
      model,
      embedProvider,
      embedModel,
      embedSimilarity: similarity.trim() === '' ? null : Number(similarity),
      // An empty address means "use the preset's own", which mergeConfig reads as a
      // request to clear the override.
      baseUrl: baseUrl.trim(),
      embedBaseUrl: embedBaseUrl.trim(),
    }
    // Only send a key when one was typed, so an empty box does not erase it.
    if (apiKey.trim()) patch.apiKey = apiKey.trim()
    if (embedApiKey.trim()) patch.embedApiKey = embedApiKey.trim()

    const ok = await save(patch)
    if (ok) {
      setApiKey('')
      setEmbedApiKey('')
      setSaved(true)
      await onRefreshModel()
    }
    return ok
  }

  async function test(kind: 'chat' | 'embed') {
    if (!(await persist())) return
    const result = await modelTools.testConnection(kind)
    setNote(
      result.ok
        ? {
            ok: true,
            text: `${kind === 'chat' ? 'the model' : 'embeddings'} replied in ${result.ms} ms — ${result.detail ?? ''}`,
          }
        : { ok: false, text: result.error ?? 'the call failed' },
    )
  }

  /**
   * Whether an address is worth asking for.
   *
   * True for a preset whose own address is localhost — Ollama, oMLX, vLLM, LM Studio —
   * because a remote one is the ordinary case there, and for a custom endpoint, which has
   * no address of its own at all. False for the hosted providers, where changing the
   * address is a mistake rather than a configuration.
   */
  const addressEditable = (id: string): boolean => {
    if (!id) return false
    const option = providers.find((entry) => entry.id === id)
    if (!option) return false
    if (option.id === 'custom') return true
    return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(option.baseUrl)
  }

  const chatProviderOption = providers.find((entry) => entry.id === provider)
  const embedProviderOption = providers.find((entry) => entry.id === embedProvider)

  if (!loaded) return <p className="text-xs text-ink-faint">loading…</p>
  if (config === null) {
    return (
      <p className="text-xs text-warn">
        The model settings live on the server, and it is not reachable from here. Fix the server
        connection first, then come back.
      </p>
    )
  }

  return (
    <>
      <Field label="Provider">
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          className={inputClass}
        >
          <option value="">— server default —</option>
          {providers.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </Field>

      {/* Shown when the preset's own address is localhost, or when there is no preset at
          all — the two cases where pointing somewhere else is the normal thing rather than
          a mistake. A remote Ollama lives here. */}
      {addressEditable(provider) ? (
        <Field label="Model server address">
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={chatProviderOption?.baseUrl || 'https://example.com/v1'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={inputClass}
          />
          <p className="text-xs text-ink-faint">
            {chatProviderOption?.baseUrl
              ? `Leave empty for ${chatProviderOption.baseUrl}`
              : 'The full base URL, including /v1 if the server uses it.'}
          </p>
        </Field>
      ) : null}

      <ModelPicker
        label="Model"
        value={model}
        options={chatModels}
        onChange={setModel}
        custom={customChat}
        onCustomChange={setCustomChat}
        loading={modelTools.listing === 'chat'}
        onLoad={() =>
          void persist().then((ok) => {
            if (ok) void loadModels('chat')
          })
        }
        placeholder={config.model ?? ''}
      />

      <Field label={`API key ${config.apiKeySet ? '(set)' : '(not set)'}`}>
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          placeholder={config.apiKeySet ? 'type to replace' : 'paste a key'}
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <Field label="Embedding provider">
        <select
          value={embedProvider}
          onChange={(event) => setEmbedProvider(event.target.value)}
          className={inputClass}
        >
          <option value="">— none, or the chat provider —</option>
          {providers
            .filter((option) => !option.noEmbeddings)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
        </select>
      </Field>

      {addressEditable(embedProvider) ? (
        <Field label="Embedding server address">
          <input
            value={embedBaseUrl}
            onChange={(event) => setEmbedBaseUrl(event.target.value)}
            placeholder={embedProviderOption?.baseUrl || 'https://example.com/v1'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={inputClass}
          />
          <p className="text-xs text-ink-faint">
            {embedProviderOption?.baseUrl
              ? `Leave empty for ${embedProviderOption.baseUrl}`
              : 'The full base URL, including /v1 if the server uses it.'}
          </p>
        </Field>
      ) : null}

      <ModelPicker
        label="Embedding model"
        value={embedModel}
        options={embedModels}
        onChange={setEmbedModel}
        custom={customEmbed}
        onCustomChange={setCustomEmbed}
        loading={modelTools.listing === 'embed'}
        onLoad={() =>
          void persist().then((ok) => {
            if (ok) void loadModels('embed')
          })
        }
        placeholder={config.embedModel ?? ''}
      />

      <Field label={`Embedding key ${config.embedApiKeySet ? '(set)' : '(not set)'}`}>
        <input
          value={embedApiKey}
          onChange={(event) => setEmbedApiKey(event.target.value)}
          type="password"
          placeholder={config.embedApiKeySet ? 'type to replace' : 'paste a key'}
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <Field label="Similarity floor (0–1)">
        <input
          value={similarity}
          onChange={(event) => setSimilarity(event.target.value)}
          inputMode="decimal"
          placeholder={config.embedSimilarity === null ? '0.75 default' : ''}
          className={inputClass}
        />
      </Field>

      <p className="text-xs text-ink-soft">
        in use now: {config.configured ? `${config.providerName} · ${config.model}` : 'none'}
        {config.embeddings
          ? ` · embeddings via ${config.embedProviderName ?? '?'}`
          : ' · no embeddings'}
      </p>
      {/* The address the server will actually call. It is the thing that is wrong when a
          self-hosted model does not answer, and it used to be invisible. */}
      {modelStatus?.baseUrl ? (
        <p className="text-xs text-ink-faint">
          calling {modelStatus.baseUrl}
          {modelStatus.embedBaseUrl && modelStatus.embedBaseUrl !== modelStatus.baseUrl
            ? ` · embeddings at ${modelStatus.embedBaseUrl}`
            : ''}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void persist().then((ok) => {
              if (ok) void loadModels('chat')
            })
          }
          disabled={modelTools.listing !== null}
          className={buttonClass}
        >
          <ButtonLabel busy={modelTools.listing === 'chat'}>
            {modelTools.listing === 'chat' ? 'Loading…' : 'Load models'}
          </ButtonLabel>
        </button>
        <button
          type="button"
          onClick={() => void test('chat')}
          disabled={modelTools.testing !== null}
          className={buttonClass}
        >
          <ButtonLabel busy={modelTools.testing === 'chat'}>
            {modelTools.testing === 'chat' ? 'Testing…' : 'Test model'}
          </ButtonLabel>
        </button>
        <button
          type="button"
          onClick={() =>
            void persist().then((ok) => {
              if (ok) void loadModels('embed')
            })
          }
          disabled={modelTools.listing !== null}
          className={buttonClass}
        >
          <ButtonLabel busy={modelTools.listing === 'embed'}>
            {modelTools.listing === 'embed' ? 'Loading…' : 'Load embedding models'}
          </ButtonLabel>
        </button>
        <button
          type="button"
          onClick={() => void test('embed')}
          disabled={modelTools.testing !== null}
          className={buttonClass}
        >
          <ButtonLabel busy={modelTools.testing === 'embed'}>
            {modelTools.testing === 'embed' ? 'Testing…' : 'Test embeddings'}
          </ButtonLabel>
        </button>
      </div>

      {note ? (
        <p className={`text-xs ${note.ok ? 'text-good' : 'text-warn'}`}>{note.text}</p>
      ) : (
        <p className="text-xs text-ink-faint">
          Load and Test save your changes first, then act on them.
        </p>
      )}

      {error ? <p className="text-xs text-warn">{error}</p> : null}
      {saved && !error ? <p className="text-xs text-good">saved</p> : null}

      <button
        type="button"
        onClick={() => void persist()}
        disabled={saving}
        className={primaryButtonClass}
      >
        <ButtonLabel busy={saving}>{saving ? 'Saving…' : 'Save model settings'}</ButtonLabel>
      </button>
    </>
  )
}
