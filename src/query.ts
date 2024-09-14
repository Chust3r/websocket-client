export function stringifyUrl(
	url: string,
	params: Record<string, string | number | boolean>
): string {
	const query = new URLSearchParams()

	for (const key in params) {
		if (params.hasOwnProperty(key)) {
			const value = params[key]

			if (value !== undefined) {
				query.append(key, String(value))
			}
		}
	}

	return `${url}?${query.toString()}`
}
