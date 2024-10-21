# import os
# from multiprocessing import Process
from telegram import  Update #,Bot
from telegram.ext import CommandHandler, CallbackContext#,  Updater, MessageHandler

from telegram.ext import ApplicationBuilder

# from datetime import time
from enum import Enum
import json
from background_browser import BackgroundBrowser

class CHAT_ID(Enum):
    MAIN = -1001309586738
    TERRADIMEZZO = -4065233780

screenshot_path = 'screenshot.png'
bb = BackgroundBrowser()

def token():
    with open('keys.json') as f:
        TOKEN = json.load(f)['bot_token']
    return TOKEN


# async def render_calendario(job):
#     print(f"Update {screenshot_path}")
#     await screenshot.take()


# pubblica in chat generale lunedì@15.30
# async def calendario_to_main(context: CallbackContext):
#     await context.bot.send_photo(
#         chat_id = CHAT_ID.MAIN.value, 
#         photo=open(screenshot_path, 'rb')
#     )


# /calendario
# async def calendario_to_terradimezzo(context: CallbackContext):
#     await context.bot.send_photo(
#         chat_id = CHAT_ID.TERRADIMEZZO.value,
#         photo=open(screenshot_path, 'rb'),
#         caption="Ao ditemi se va tutto bene, alle 15.30 pubblico"
#     )


# reply calendario
async def calendario(update: Update, _):
    await bb.take_screenshot()
    if update.message:
        await update.message.reply_photo(photo=open(screenshot_path, 'rb'))


def main():  
    # Costruisci bot
    application = ApplicationBuilder().token(token()).build()
    application.add_handler(CommandHandler('calendario', calendario))
    #application.add_handler(MessageHandler(filters=None,callback=duh))

    # Crea la JQ e aggiungi update automatici al calendario
    # job_queue = application.job_queue
    #job_queue.run_repeating(render_calendario, interval = 60, name="update_calendar") #Aggiorna il calendario ogni minuto
    # job_queue.run_daily(calendario_to_terradimezzo, time=time(10,0),days=(0,), name="posta_in_terradimezzo") #posta di lunedì alle 10.00 nel gruppo terradimezzo
    # job_queue.run_daily(calendario_to_terradimezzo, time=time(15,30),days=(0,),name="posta_calendario") #Posta di lunedì alle 15.30 nel gruppo grande

    
    application.run_polling()



if __name__ == '__main__':
    main()
    # asyncio.run(main())
