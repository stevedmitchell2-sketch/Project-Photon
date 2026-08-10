import unreal
unreal.log("PROBE ValueType: " + str([m for m in dir(unreal.InputActionValueType) if not m.startswith('_')]))
unreal.log("PROBE HasKeys: " + str(hasattr(unreal, 'Keys')))
if hasattr(unreal, 'Keys'):
    ks = [m for m in dir(unreal.Keys) if 'GAMEPAD_RIGHT_TRIGGER' in m or 'SPACE' in m or 'LEFT_MOUSE' in m]
    unreal.log("PROBE KeySample: " + str(ks))
unreal.log("PROBE IMC methods: " + str([m for m in dir(unreal.InputMappingContext) if not m.startswith('_')]))
unreal.log("PROBE DataAssetFactory: " + str(hasattr(unreal, 'DataAssetFactory')))
unreal.log("PROBE PhotonWeaponData: " + str(hasattr(unreal, 'PhotonWeaponData')))
