import unreal
unreal.log("KP dir(Key): " + str([m for m in dir(unreal.Key) if not m.startswith('_')]))
for label, fn in [
    ("positional", lambda: unreal.Key("SpaceBar")),
    ("noarg+set", lambda: (lambda k: (k.set_editor_property("key_name", "SpaceBar"), k)[1])(unreal.Key())),
]:
    try:
        k = fn()
        unreal.log("KP OK {} -> {}".format(label, k))
    except Exception as e:
        unreal.log("KP FAIL {} -> {}".format(label, e))
# try an actual map_key against the saved context
try:
    ctx = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Input/IMC_Photon")
    act = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Input/IA_Jump")
    for label, mk in [("pos", lambda: unreal.Key("SpaceBar")),
                      ("set", lambda: (lambda k:(k.set_editor_property("key_name","SpaceBar"),k)[1])(unreal.Key()))]:
        try:
            ctx.map_key(act, mk())
            unreal.log("KP MAPPED via " + label + " count=" + str(len(ctx.get_editor_property("mappings"))))
            break
        except Exception as e:
            unreal.log("KP MAPFAIL " + label + " -> " + str(e))
except Exception as e:
    unreal.log("KP CTXFAIL " + str(e))
