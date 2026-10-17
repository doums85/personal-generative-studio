/** Where the login page sends a visitor whose credentials were refused; the page shows its error message for it. */
export const LOGIN_ERROR_PATH = '/login?error=CredentialsSignin';

/**
 * Signs the owner in from the login form.
 *
 * `signIn` throws an auth error when the e-mail is not allowed or the password is wrong, which would
 * otherwise surface as a server error page. Only that error is turned into a redirect back to the form:
 * a successful sign-in also "throws" (Next's redirect to the studio) and any other failure is a real
 * problem, so everything else is rethrown untouched.
 */
export async function signInWithPassword(formData, { signIn, redirect, isAuthError }) {
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/studio',
    });
  } catch (error) {
    if (isAuthError(error)) redirect(LOGIN_ERROR_PATH);
    throw error;
  }
}
