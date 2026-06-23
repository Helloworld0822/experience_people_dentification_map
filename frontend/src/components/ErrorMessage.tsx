type ErrorMessageProps = {
  message: string | null
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  if (!message) {
    return null
  }

  return <p className="error" role="alert">{message}</p>
}
