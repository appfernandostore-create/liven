document.addEventListener('DOMContentLoaded', function () {
  const eyeButtons = document.querySelectorAll('.eye-toggle');
  eyeButtons.forEach(button => {
    button.addEventListener('click', function () {
      const parent = this.closest('.password-field');
      const input = parent.querySelector('input');
      if (input.type === 'password') {
        input.type = 'text';
        this.textContent = '🙈';
      } else {
        input.type = 'password';
        this.textContent = '👁';
      }
    });
  });

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = formData.get('email');
      const password = formData.get('password');

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const result = await response.json();
        if (!response.ok) {
          alert(result.message || 'Error de inicio de sesión');
          return;
        }

        window.location.href = result.redirect || '/dashboard.html';
      } catch (error) {
        alert('No se pudo iniciar sesión. Intenta de nuevo.');
      }
    });
  }

  const registerForm = document.querySelector('.register-form');
  if (registerForm) {
    const modal = document.getElementById('successModal');
    const modalClose = document.getElementById('modalClose');

    registerForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const password = registerForm.querySelector('input[name="password"]').value;
      const confirmPassword = registerForm.querySelector('input[name="confirmPassword"]').value;
      if (password !== confirmPassword) {
        alert('Las contraseñas no coinciden. Por favor verifica.');
        return;
      }
      modal.classList.remove('hidden');
    });

    if (modalClose) {
      modalClose.addEventListener('click', function () {
        document.getElementById('successModal').classList.add('hidden');
      });
    }

    document.querySelector('.modal-overlay').addEventListener('click', function (event) {
      if (event.target === this) {
        this.classList.add('hidden');
      }
    });
  }
});
