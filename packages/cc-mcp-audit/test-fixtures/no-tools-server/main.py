"""Server with no recognizable tool patterns."""


def start():
    print("Starting server...")


class Handler:
    def process(self, data):
        return {"result": data}
