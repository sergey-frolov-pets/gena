import { ref } from "vue";

/** Выбранный агент. Общий для шапки и чата, чтобы список не жил внутри Teleport. */
export const agentId = ref("");
