import type { ModAction } from "@rave/shared/client";

export const ACTION_LABEL: Record<ModAction, string> = {
  ban: "Бан",
  unban: "Разбан",
  player_edit: "Правка игрока",
  config_save: "Конфиг",
  config_rollback: "Откат конфига",
  rollback_player: "Откат игрока",
  clear_area: "Очистка области",
  remove_bombs: "Снятие бомб",
};

export const ITEM_LABEL = {
  coins: "Монеты",
  bomb: "Бомбы",
  detector: "Детектор",
  defuser: "Дефьюзер",
} as const;

const ERROR_TEXT: Record<string, string> = {
  self: "Нельзя заблокировать себя",
  target_is_admin: "Нельзя заблокировать администратора",
  bad_until: "Дата окончания уже прошла",
  not_banned: "Игрок не заблокирован",
  not_found: "Не найдено",
  nothing_to_change: "Нечего менять",
  negative_balance: "Баланс ушёл бы ниже нуля",
  stale: "Конфиг уже изменили — загрузите свежую версию",
  invalid: "Конфиг не прошёл проверку",
};

export function adminErrorText(code: string | undefined): string {
  return (code && ERROR_TEXT[code]) || "Действие не удалось";
}
