FROM public.ecr.aws/lambda/python:3.12

# Minimal handler — only used to verify the instrumenter skips container image
# functions gracefully; this function is never actually invoked.
RUN echo 'def handler(event, context): return {}' > /var/task/handler.py

CMD ["handler.handler"]
