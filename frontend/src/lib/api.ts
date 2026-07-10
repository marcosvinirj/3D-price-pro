/** Cliente HTTP fino com injecao de token JWT e tratamento de erro. */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

const TOKEN_KEY = 'precificacao3d.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detalhes?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });

  if (res.status === 401) {
    tokenStore.clear();
  }

  const texto = await res.text();
  const dados = texto ? JSON.parse(texto) : null;

  if (!res.ok) {
    throw new ApiError(res.status, dados?.mensagem ?? 'Erro na requisição', dados?.detalhes);
  }
  return dados as T;
}

/**
 * Baixa um arquivo protegido por JWT. Como o token vai no header (não dá para
 * usar um <a href> simples), buscamos o blob e disparamos o download.
 */
async function baixarArquivo(caminho: string, nomePadrao: string): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${caminho}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    if (res.status === 401) tokenStore.clear();
    throw new ApiError(res.status, 'Falha ao baixar arquivo');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomePadrao;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(caminho: string) => request<T>('GET', caminho),
  post: <T>(caminho: string, corpo?: unknown) => request<T>('POST', caminho, corpo),
  patch: <T>(caminho: string, corpo?: unknown) => request<T>('PATCH', caminho, corpo),
  del: <T>(caminho: string) => request<T>('DELETE', caminho),
  baixar: baixarArquivo,
};
