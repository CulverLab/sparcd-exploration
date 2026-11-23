let last = 0

/**
 * Orders one thing against another: when a read started, when a write landed.
 * Both happen inside the same millisecond often enough that a clock cannot
 * separate them, so this counts instead.
 */
export const moment = () => ++last
