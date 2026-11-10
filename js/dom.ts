// DOM helpers shared by the page's modules: element lookup by id and switching between screens.
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SECTIONS = ["lobby", "room", "game", "end"];
export const show = (...names: string[]) => SECTIONS.forEach((s) => ($(s).hidden = !names.includes(s)));
