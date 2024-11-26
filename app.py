from flask import Flask, render_template
from usominidom import getContenutoFinale
import socket

import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)
DAYS_FORWARD = 5

@app.route('/favicon.ico')
def favicon():
    return '', 204  # Restituisce una risposta vuota senza contenuto (status code 204)

@app.route('/')
def index():
    # Recupera la settimana dal calendario
    week_data = getContenutoFinale(DAYS_FORWARD)
    return render_template('index_refractor.html', week_data=week_data)

def find_free_port():
    """Trova una porta libera sul sistema."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

def run(port=None, daysforward=DAYS_FORWARD):
    global DAYS_FORWARD
    if port is None:
        port = find_free_port()
    DAYS_FORWARD = daysforward
    app.run(port=port)
    return port


if __name__ == '__main__':
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.DEBUG)
    run()