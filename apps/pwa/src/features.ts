/**
 * Whether promoting writes a note into your vault.
 *
 * Off for now, deliberately, while the writing side waits: putting a file into somebody's
 * vault is a promise about their file system, and it needs the path to be right, the folder
 * to exist and the naming to be settled. Exporting does everything up to the file — the
 * note is rendered exactly as it would have been written, and you save, download or share
 * it yourself.
 *
 * Nothing is lost by turning this back on. The promote path is still here, the server route
 * is still there, and the vault settings are still there.
 */
export const PROMOTE_ENABLED = false
