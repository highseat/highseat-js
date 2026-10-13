/** A value an event property can hold. */
export type PropertyValue = string | number | boolean

/** The properties sent with an event. */
export type Properties = Record<string, PropertyValue>

/** Records a custom event. */
export function track(_name: string, _properties?: Properties): void {}

/** Links the current visitor to a user id from your own system. */
export function identify(_id: string): void {}
