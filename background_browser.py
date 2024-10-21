import asyncio
from multiprocessing import Process
import app, time
from pyppeteer import launch
LOCALHOST = "127.0.0.1"

class BackgroundBrowser:
    def __init__(self):
        self.browser = None
        self.page = None
        self.port = None
        self.flask_process = None

    async def init_browser(self):
        """Avvia il browser e apre una pagina."""
        self.browser = await launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        self.page = await self.browser.newPage()
        self.flask_process, self.port = await start_flask_app()
    
    
    async def take_screenshot(self, ip=None, output_path=None):
        """Aggiorna la pagina e scatta uno screenshot."""
        if self.flask_process is None:
            await self.init_browser()
        time.sleep(0.1)

        url = f'http://{(ip or LOCALHOST)}:{self.port}/'
        await self.page.goto(url, {'waitUntil': 'networkidle0'})

        # Ottieni altezza della pagina
        zoom_level = 2.0
        await self.page.evaluate(f"document.body.style.zoom='{zoom_level}'")
        page_height = await self.page.evaluate("""
            () => {
                var body = document.body,
                    html = document.documentElement;

                var height = Math.max(
                    body.scrollHeight, body.offsetHeight, html.clientHeight,
                    html.scrollHeight, html.offsetHeight);
                return height;
            }
        """)
        # print(f"Altezza della pagina: {page_height}")
        page_width = 480 * zoom_level

        # Cattura screenshot
        await self.page.setViewport({'width': int(page_width), 'height': int(page_height)})
        await self.page.screenshot({'path': (output_path or 'screenshot.png'), 'fullPage': True})

    async def on_close(self):
        """Chiude il browser."""
        if self.browser:
            await self.browser.close()
        if self.flask_process:
            self.flask_process.terminate()

async def start_flask_app():
    """Avvia il server Flask in un processo separato."""
    port = app.find_free_port()
    p = Process(target=app.run, args=(port,))
    p.start()
    await asyncio.sleep(0.1)  # Attendi che il server Flask si avvii completamente
    return p, port
