document.addEventListener(
  'DOMContentLoaded',
  async () => {
    const client =
      window.globalQuerySupabase;

    const {
      data: { session }
    } =
      await client.auth.getSession();

    if (session) {
      showPasswordSetup_();
    }
  }
);

function showPasswordSetup_() {
  document
    .getElementById('authScreen')
    .hidden = false;
}

document
  .getElementById('setPasswordForm')
  .addEventListener(
    'submit',
    async event => {
      event.preventDefault();

      const password =
        document
          .getElementById(
            'newPassword'
          )
          .value;

      const { error } =
        await window
          .globalQuerySupabase
          .auth
          .updateUser({
            password
          });

      if (error) {
        document
          .getElementById(
            'authMessage'
          )
          .textContent =
            error.message;

        return;
      }

      document
        .getElementById(
          'authMessage'
        )
        .textContent =
          'Account created successfully.';
    }
  );
