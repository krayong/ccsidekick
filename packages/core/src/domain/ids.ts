// Branded string ids: nominal wrappers that stop a Session id and a Project id from being assigned to each other.

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type Session = Branded<string, "Session">;
export type Project = Branded<string, "Project">;

export const asSession = (s: string): Session => s as Session;
export const asProject = (s: string): Project => s as Project;
