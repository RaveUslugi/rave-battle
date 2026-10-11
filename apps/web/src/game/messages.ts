const REJECT_TEXT: Record<string, string> = {
  unauthorized: "Войдите, чтобы рисовать",
  login_required: "Войдите, чтобы играть",
  unavailable: "Сервер недоступен, попробуйте позже",
  timeout: "Нет ответа от сервера",
  banned: "Вы заблокированы",
  not_guild_member: "Играть могут только участники сообщества",
  account_too_new: "Аккаунт Discord слишком новый для игры",
  frozen: "Вы заморожены",
  out_of_bounds: "Клетка за пределами холста",
  invalid_color: "Неизвестный цвет",
  color_locked: "Этот цвет ещё не открыт",
  no_charges: "Нет зарядов",
  no_bombs: "Бомбы закончились",
  bomb_limit: "Достигнут лимит активных бомб",
  no_detector: "Детекторы закончились",
  no_defuser: "Дефьюзеры закончились",
  rate_limited: "Слишком часто, подождите немного",
  insufficient_coins: "Не хватает монет",
  boost_limit: "Достигнут максимум буста зарядов",
  not_for_sale: "Этот товар не продаётся",
  already_unlocked: "Этот цвет уже открыт",
  already_claimed: "Награда за сегодня уже получена",
};

/** Human text for a reject code from the server or from the client-side pre-check. */
export function rejectText(code: string): string {
  return REJECT_TEXT[code] ?? "Действие не удалось";
}
