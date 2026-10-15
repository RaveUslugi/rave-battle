/**
 * Russian strings: the reference dictionary. `en.ts` must have exactly the same keys (typecheck).
 * Interpolation uses {{name}}; plurals use i18next's _one/_few/_many/_other suffixes.
 */
export const ru = {
  common: {
    close: "Закрыть",
    cancel: "Отмена",
    confirm: "Подтвердить",
    save: "Сохранить",
    retry: "Повторить",
    loading: "Загрузка…",
    back: "Назад",
  },
  locale: {
    label: "Язык",
    ru: "Русский",
    en: "English",
  },
  kit: {
    sheetHandle: "Высота панели",
    locked: "Закрыто",
    effect: "Эффект",
    selected: "выбран",
  },
  reject: {
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
    insufficient_coins: "Не хватает монет",
    boost_limit: "Достигнут максимум буста зарядов",
    not_for_sale: "Этот товар не продаётся",
    already_unlocked: "Этот цвет уже открыт",
    already_claimed: "Награда за сегодня уже получена",
    unauthorized: "Войдите, чтобы рисовать",
    login_required: "Войдите, чтобы играть",
    unavailable: "Сервер недоступен, попробуйте позже",
    timeout: "Нет ответа от сервера",
    rate_limited: "Слишком часто, подождите немного",
    fallback: "Действие не удалось",
  },
  chat: {
    chat_disabled: "Чат выключен",
    empty: "Напишите что-нибудь",
    too_long: "Слишком длинное сообщение",
    no_access: "Писать в чат могут только игроки с доступом к игре",
    muted: "Вам отключили чат до {{until}}",
    muted_permanent: "Вам отключили чат",
    cooldown: "Не так быстро — можно через {{seconds}} с",
  },
};

export type Dictionary = typeof ru;
