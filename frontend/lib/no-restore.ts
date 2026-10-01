/**
 * Spread onto buttons whose `disabled` changes at runtime. Firefox restores a control's
 * last disabled state on reload, which overrides the SSR HTML and breaks hydration.
 * React's button typings omit `autoComplete`, hence the cast.
 */
export const noRestore = { autoComplete: "off" } as Record<string, string>;
