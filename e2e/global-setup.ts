/**
 * Fails the whole run early (with a readable message) if the backend isn't up,
 * instead of letting every test die on opaque network errors.
 */
const BACKEND = 'http://localhost:8080';

export default async function globalSetup() {
  try {
    // Any HTTP response (even 401) means the server is listening.
    await fetch(`${BACKEND}/api/auth/me`);
  } catch {
    throw new Error(
      `\n\n  Бекенд не відповідає на ${BACKEND}.\n` +
        `  Запусти його перед E2E:  cd C:\\Work\\majstr-backend ; ./gradlew bootRun\n` +
        `  (CORS бекенду має містити http://localhost:5173)\n`,
    );
  }
}
